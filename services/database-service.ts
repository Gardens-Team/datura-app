// services/database.ts
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase() {
  if (db === null) {
    db = await SQLite.openDatabaseAsync('gardens.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS local_user (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL,
        profile_pic TEXT
      );

      CREATE TABLE IF NOT EXISTS gardens (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        creator TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        logo TEXT
      );
      
      CREATE TABLE IF NOT EXISTS memberships (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        garden_id TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        encrypted_group_key TEXT NOT NULL
      );
      
    `);
  }
  return db;
}

export async function saveUserProfile(id: string, username: string, profilePic: string) {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO local_user (id, username, profile_pic) VALUES (?, ?, ?)',
    [id, username, profilePic]
  );
}

export async function getCurrentUser() {
  const db = await getDatabase();
  return db.getFirstAsync('SELECT * FROM local_user LIMIT 1');
}