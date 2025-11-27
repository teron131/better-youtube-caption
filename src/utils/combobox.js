/**
 * Combobox Component
 * Combines text input with dropdown for selecting or typing values
 */

import { DEFAULTS, RECOMMENDED_REFINER_MODELS, RECOMMENDED_SUMMARIZER_MODELS, STORAGE_KEYS, TARGET_LANGUAGES } from "../constants.js";
import { saveSetting } from "../storage.js";
import { getProviderIcon } from "./ui.js";

/**
 * Initialize comboboxes
 */
export function initializeComboboxes() {
  const comboboxes = document.querySelectorAll('.combobox[data-combobox-type]');
  
  comboboxes.forEach(combobox => {
    const comboboxType = combobox.dataset.comboboxType;
    const input = combobox.querySelector('.combobox-input');
    const arrow = combobox.querySelector('.combobox-arrow');
    const dropdown = combobox.querySelector('.combobox-dropdown');
    const icon = combobox.querySelector('.combobox-icon');
    
    if (!input || !arrow || !dropdown || !icon) return;
    
    // Populate dropdown based on type
    dropdown.innerHTML = '';
    let options = [];
    let storageKeys = {};
    
    if (comboboxType === 'targetLanguage') {
      options = TARGET_LANGUAGES;
      storageKeys = {
        recommended: STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED,
        custom: STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM
      };
    } else if (comboboxType === 'summarizer') {
      options = RECOMMENDED_SUMMARIZER_MODELS;
      storageKeys = {
        recommended: STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL,
        custom: STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL
      };
    } else if (comboboxType === 'refiner') {
      options = RECOMMENDED_REFINER_MODELS;
      storageKeys = {
        recommended: STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
        custom: STORAGE_KEYS.REFINER_CUSTOM_MODEL
      };
    }
    
    // Populate dropdown
    options.forEach(option => {
      const item = createComboboxItem(option, comboboxType);
      dropdown.appendChild(item);
    });
    
    // Initial value will be set by loadSettings via setComboboxValue
    
    // Arrow click - toggle dropdown
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCombobox(combobox);
    });
    
    // Input focus - show dropdown
    input.addEventListener('focus', () => {
      combobox.classList.add('open');
      dropdown.classList.add('show');
    });
    
    // Input typing - filter dropdown
    input.addEventListener('input', (e) => {
      filterComboboxDropdown(combobox, e.target.value);
      // Save the value as custom
      const value = e.target.value.trim();
      
      // Update icon for models when typing
      if ((comboboxType === 'summarizer' || comboboxType === 'refiner') && value) {
        updateComboboxModelIcon(combobox, value);
      }
      
      if (value && storageKeys.custom) {
        saveSetting(storageKeys.custom, value);
        // Clear recommended if custom is set
        if (storageKeys.recommended) {
          saveSetting(storageKeys.recommended, '');
        }
      } else {
        // Clear custom if empty
        if (storageKeys.custom) {
          saveSetting(storageKeys.custom, '');
        }
        // Clear icon if empty
        if ((comboboxType === 'summarizer' || comboboxType === 'refiner') && icon) {
          icon.innerHTML = '';
        }
      }
    });
    
    // Dropdown item click
    dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.combobox-item');
      if (!item) return;
      
      const value = item.dataset.value;
      
      // Set input value
      input.value = value;
      
      // Update icon
      if (comboboxType === 'targetLanguage') {
        updateComboboxIcon(combobox, value);
      } else if (comboboxType === 'summarizer' || comboboxType === 'refiner') {
        updateComboboxModelIcon(combobox, value);
      }
      
      // Update selected state in dropdown
      dropdown.querySelectorAll('.combobox-item').forEach(i => {
        i.classList.remove('selected');
      });
      item.classList.add('selected');
      
      // Close dropdown
      combobox.classList.remove('open');
      dropdown.classList.remove('show');
      
      // Save as recommended (clear custom)
      if (storageKeys.recommended) {
        saveSetting(storageKeys.recommended, value);
      }
      if (storageKeys.custom) {
        saveSetting(storageKeys.custom, '');
      }
    });
    
    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!combobox.contains(e.target)) {
        combobox.classList.remove('open');
        dropdown.classList.remove('show');
      }
    });
  });
}

/**
 * Create combobox item element
 */
function createComboboxItem(option, comboboxType) {
  const item = document.createElement('div');
  item.className = 'combobox-item';
  item.dataset.value = option.value;
  
  const icon = document.createElement('span');
  icon.className = 'combobox-item-icon';
  
  if (comboboxType === 'targetLanguage') {
    // Extract emoji from label (only for targetLanguage)
    const emojiMatch = option.label.match(/^(\p{Emoji}+)\s*(.+)$/u);
    if (emojiMatch) {
      icon.textContent = emojiMatch[1];
    }
  } else if (comboboxType === 'summarizer' || comboboxType === 'refiner') {
    // For model selects, show provider icon
    const provider = option.value.split('/')[0];
    const iconSrc = getProviderIcon(provider);
    if (iconSrc) {
      const img = document.createElement('img');
      img.src = iconSrc;
      img.alt = provider;
      img.width = 16;
      img.height = 16;
      icon.appendChild(img);
    }
  }
  item.appendChild(icon);
  
  const label = document.createElement('span');
  label.className = 'combobox-item-label';
  
  // Remove emoji from label text (only for targetLanguage)
  if (comboboxType === 'targetLanguage') {
    const emojiMatch = option.label.match(/^(\p{Emoji}+)\s*(.+)$/u);
    if (emojiMatch) {
      label.textContent = emojiMatch[2].trim();
    } else {
      label.textContent = option.label;
    }
  } else {
    label.textContent = option.label;
  }
  item.appendChild(label);
  
  return item;
}

/**
 * Toggle combobox dropdown
 */
function toggleCombobox(combobox) {
  const dropdown = combobox.querySelector('.combobox-dropdown');
  const isOpen = combobox.classList.contains('open');
  
  // Close all other comboboxes
  document.querySelectorAll('.combobox.open').forEach(cb => {
    if (cb !== combobox) {
      cb.classList.remove('open');
      cb.querySelector('.combobox-dropdown').classList.remove('show');
    }
  });
  
  if (isOpen) {
    combobox.classList.remove('open');
    dropdown.classList.remove('show');
  } else {
    combobox.classList.add('open');
    dropdown.classList.add('show');
    // Focus input
    const input = combobox.querySelector('.combobox-input');
    if (input) input.focus();
  }
}

/**
 * Filter combobox dropdown based on input
 */
function filterComboboxDropdown(combobox, filterText) {
  const dropdown = combobox.querySelector('.combobox-dropdown');
  const items = dropdown.querySelectorAll('.combobox-item');
  const filterLower = filterText.toLowerCase().trim();
  
  items.forEach(item => {
    const label = item.querySelector('.combobox-item-label').textContent.toLowerCase();
    const value = item.dataset.value.toLowerCase();
    
    if (!filterLower || label.includes(filterLower) || value.includes(filterLower)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

/**
 * Update combobox icon based on value (for targetLanguage)
 */
function updateComboboxIcon(combobox, value) {
  const icon = combobox.querySelector('.combobox-icon');
  if (!icon) return;
  
  const langOption = TARGET_LANGUAGES.find(l => l.value === value);
  if (langOption) {
    const emojiMatch = langOption.label.match(/^(\p{Emoji}+)\s*(.+)$/u);
    if (emojiMatch) {
      icon.textContent = emojiMatch[1];
    } else {
      icon.textContent = '';
    }
  } else {
    icon.textContent = '';
  }
}

/**
 * Update combobox icon for model (shows provider icon)
 */
function updateComboboxModelIcon(combobox, value) {
  const icon = combobox.querySelector('.combobox-icon');
  if (!icon) return;
  
  icon.innerHTML = '';
  if (value) {
    const provider = value.split('/')[0];
    const iconSrc = getProviderIcon(provider);
    if (iconSrc) {
      const img = document.createElement('img');
      img.src = iconSrc;
      img.alt = provider;
      img.width = 16;
      img.height = 16;
      icon.appendChild(img);
    }
  }
}

/**
 * Update combobox display from storage
 */
export function updateComboboxDisplay(combobox) {
  const input = combobox.querySelector('.combobox-input');
  if (!input) return;
  
  // Get current value (custom takes priority)
  chrome.storage.local.get([
    STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM,
    STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED
  ], (result) => {
    const custom = result[STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM]?.trim();
    const recommended = result[STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED] || DEFAULTS.TARGET_LANGUAGE_RECOMMENDED;
    
    const value = custom || recommended;
    input.value = value;
    updateComboboxIcon(combobox, value);
    
    // Mark selected item in dropdown
    const dropdown = combobox.querySelector('.combobox-dropdown');
    if (dropdown) {
      dropdown.querySelectorAll('.combobox-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.value === value) {
          item.classList.add('selected');
        }
      });
    }
  });
}

/**
 * Set combobox value programmatically
 */
export function setComboboxValue(comboboxType, value) {
  const combobox = document.querySelector(`[data-combobox-type="${comboboxType}"]`);
  if (!combobox) return;
  
  const input = combobox.querySelector('.combobox-input');
  const icon = combobox.querySelector('.combobox-icon');
  if (input) {
    input.value = value || '';
    
    // Update icon
    if (comboboxType === 'targetLanguage') {
      updateComboboxIcon(combobox, value);
    } else if (comboboxType === 'summarizer' || comboboxType === 'refiner') {
      updateComboboxModelIcon(combobox, value);
    }
    
    // Mark selected item
    const dropdown = combobox.querySelector('.combobox-dropdown');
    if (dropdown) {
      dropdown.querySelectorAll('.combobox-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.value === value) {
          item.classList.add('selected');
        }
      });
    }
  }
}
