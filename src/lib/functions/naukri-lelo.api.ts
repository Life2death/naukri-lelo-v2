import { safeLocalStorage } from "../storage";
import { STORAGE_KEYS } from "@/config";

// Helper function to check if Naukri Lelo API should be used
export async function shouldUseNaukriLeloAPI(): Promise<boolean> {
  try {
    // Check if Naukri Lelo API is enabled in localStorage
    const naukriLeloApiEnabled =
      safeLocalStorage.getItem(STORAGE_KEYS.NAUKRI_LELO_API_ENABLED) === "true";
    if (!naukriLeloApiEnabled) return false;

    // License check removed - app is free
    return true;
  } catch (error) {
    console.warn("Failed to check Naukri Lelo API availability:", error);
    return false;
  }
}
