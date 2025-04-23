"use client"

import type React from "react"
import { createContext, useContext, useState } from "react"
import { useColorScheme } from "react-native"

type Theme = "light" | "dark" | "system"

interface ThemeContextType {
  theme: Theme
  isDarkMode: boolean
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme()
  const [theme, setTheme] = useState<Theme>("system")

  const isDarkMode = theme === "system" ? colorScheme === "dark" : theme === "dark"

  return <ThemeContext.Provider value={{ theme, isDarkMode, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
