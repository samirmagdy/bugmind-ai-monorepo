/**
 * A simple storage obfuscation utility for Chrome Extension.
 * This provides a layer of defense against plain-text inspection of chrome.storage.local.
 * It is NOT a substitute for formal encryption but prevents easy extraction of Jira tokens.
 */

const SALT = 'bugmind-ai-protector-v1';

/**
 * Basic XOR-based obfuscation + Base64 encoding.
 */
export const obfuscate = (text: string): string => {
  if (!text) return '';
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
  }
  try {
    return btoa(result);
  } catch {
    // Fallback for non-latin chars if any
    return btoa(encodeURIComponent(result));
  }
};

/**
 * Reverse of obfuscate.
 */
export const deobfuscate = (encoded: string): string => {
  if (!encoded) return '';
  try {
    let decoded = '';
    try {
      decoded = atob(encoded);
    } catch {
      decoded = decodeURIComponent(atob(encoded));
    }
    
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
    }
    return result;
  } catch (e) {
    console.error('Failed to deobfuscate data:', e);
    return '';
  }
};
