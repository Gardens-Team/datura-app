import { useState, useEffect, useCallback } from 'react';
import {
  getGardensByUser,
  Garden,
  Membership,
  decryptGardenImage,
  getGroupKeyForGarden
} from '@/services/garden-service';
import { getStoredPrivateKeyEncryption } from '@/utils/provisioning';
import { supabase } from '@/services/supabase-singleton';

interface UseUserCreatorGardensResult {
  gardens: Garden[];
  decryptedLogos: Record<string, string>;
  loading: boolean;
  error: Error | null;
  refetchGardens: () => void;
}

export function useUserCreatorGardens(userId: string | undefined): UseUserCreatorGardensResult {
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [decryptedLogos, setDecryptedLogos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Decrypt garden logos
  const decryptLogos = useCallback(async (gardensToDecrypt: Garden[]) => {
    if (!gardensToDecrypt || gardensToDecrypt.length === 0) return {};

    console.log(`[useUserCreatorGardens] Starting decryption for ${gardensToDecrypt.length} logos.`);
    const decryptedLogoMap: Record<string, string> = {};

    try {
      const privateKeyBase64 = await getStoredPrivateKeyEncryption();
      if (!privateKeyBase64) {
        console.error('[useUserCreatorGardens] Private encryption key not found.');
        // Potentially set an error state or return empty map
        return {};
      }

      for (const garden of gardensToDecrypt) {
        if (garden.id && garden.logo && !garden.logo.startsWith('file://')) {
          try {
            // Fetch the specific group key for this garden
            const groupKeyBase64 = await getGroupKeyForGarden(garden.id);
            if (!groupKeyBase64) {
              console.warn(`[useUserCreatorGardens] No group key found for garden ${garden.id}. Skipping logo decryption.`);
              continue; // Skip if no key found
            }

            // Decrypt the logo
            const base64Data = await decryptGardenImage(garden.logo, groupKeyBase64);

            if (base64Data) {
              const dataUrl = `data:image/png;base64,${base64Data}`;
              decryptedLogoMap[garden.id] = dataUrl;
              console.log(`[useUserCreatorGardens] Successfully decrypted logo for garden ${garden.id}`);
            } else {
               console.warn(`[useUserCreatorGardens] Decryption returned empty data for garden ${garden.id}.`);
            }
          } catch (decryptError) {
            console.error(`[useUserCreatorGardens] Failed to decrypt logo for garden ${garden.id}:`, decryptError);
            // Continue to next garden even if one fails
          }
        } else if (garden.logo?.startsWith('file://')) {
             console.warn(`[useUserCreatorGardens] Skipping local file logo for garden ${garden.id}: ${garden.logo}`);
        } else {
             // console.log(`[useUserCreatorGardens] Garden ${garden.id} has no logo to decrypt.`);
        }
      }
    } catch (err) {
      console.error('[useUserCreatorGardens] Error during logo decryption process:', err);
      setError(err instanceof Error ? err : new Error('Logo decryption failed'));
      // Return whatever was decrypted successfully so far
      return decryptedLogoMap;
    }
     console.log(`[useUserCreatorGardens] Finished decryption. Decrypted ${Object.keys(decryptedLogoMap).length} logos.`);
    return decryptedLogoMap;
  }, []);

  // Fetch gardens and filter by creator role
  const fetchGardens = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setGardens([]);
    setDecryptedLogos({});

    try {
      console.log(`[useUserCreatorGardens] Fetching all gardens for user ${userId}`);
      // 1. Fetch all gardens the user is part of
      const allUserGardens = await getGardensByUser(userId);
      console.log(`[useUserCreatorGardens] Found ${allUserGardens.length} total gardens for user.`);

      if (allUserGardens.length === 0) {
        setLoading(false);
        return; // No gardens, nothing more to do
      }

      // 2. Fetch user's memberships to determine roles
      console.log(`[useUserCreatorGardens] Fetching memberships for user ${userId}`);
      const { data: memberships, error: membershipError } = await supabase
        .from('memberships')
        .select('garden_id, role')
        .eq('user_id', userId);

      if (membershipError) {
        console.error('[useUserCreatorGardens] Error fetching memberships:', membershipError);
        throw membershipError; // Propagate the error
      }

      console.log(`[useUserCreatorGardens] Found ${memberships?.length ?? 0} memberships.`);

      // 3. Filter gardens where the user's role is 'creator'
      const creatorGardenIds = new Set(
        memberships
          ?.filter((m: any) => m.role === 'creator') // Use 'any' temporarily if Membership type isn't perfect
          .map((m: any) => m.garden_id)
      );

      const creatorGardens = allUserGardens.filter(garden =>
        garden.id && creatorGardenIds.has(garden.id)
      );

      console.log(`[useUserCreatorGardens] Filtered down to ${creatorGardens.length} creator gardens.`);
      setGardens(creatorGardens);

      // 4. Decrypt logos for the filtered creator gardens
      if (creatorGardens.length > 0) {
        const logos = await decryptLogos(creatorGardens);
        setDecryptedLogos(logos);
      }

    } catch (err) {
      console.error('[useUserCreatorGardens] Failed to fetch or filter creator gardens:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch gardens'));
    } finally {
      setLoading(false);
    }
  }, [userId, decryptLogos]);

  useEffect(() => {
    fetchGardens();
  }, [fetchGardens]);

  return { gardens, decryptedLogos, loading, error, refetchGardens: fetchGardens };
} 