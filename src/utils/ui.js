/**
 * UI Utility Functions
 * Provides common UI manipulation helpers
 */

/**
 * Create provider icon element
 * @param {string} provider - Provider name (e.g., 'google', 'openai')
 * @returns {string} Icon path or empty string
 */
export function getProviderIcon(provider) {
  const icons = {
    anthropic: 'images/anthropic.svg',
    google: 'images/google.svg',
    openai: 'images/openai.svg',
    'x-ai': 'images/xai.svg',
  };
  return icons[provider] || '';
}

/**
 * Create option element for custom select dropdown
 * @param {Object} model - Model object with value and label
 * @param {string} type - Model type ('summarizer' or 'refiner')
 * @returns {HTMLElement} Option element
 */
export function createOptionElement(model, type) {
  const item = document.createElement('div');
  item.className = 'select-item';
  item.dataset.value = model.value;

  const icon = document.createElement('span');
  icon.className = 'item-icon';
  
  if (type === 'targetLanguage') {
    // For language select, extract emoji from label and put it in icon
    const labelText = model.label || model.value;
    // Match emoji at the start of the label (e.g., "🌐 Auto", "🇺🇸 English")
    const emojiMatch = labelText.match(/^(\p{Emoji}+)\s*(.+)$/u);
    if (emojiMatch) {
      const emoji = emojiMatch[1];
      icon.textContent = emoji;
      icon.style.fontSize = '16px';
      icon.style.lineHeight = '16px';
      icon.style.display = 'flex';
      icon.style.alignItems = 'center';
      icon.style.justifyContent = 'center';
    }
  } else {
    // For model selects, show provider icon
    const provider = model.value.split('/')[0];
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
  label.className = 'item-label';
  if (type === 'targetLanguage') {
    // For language select, remove emoji from label text (it's now in icon)
    const labelText = model.label || model.value;
    const emojiMatch = labelText.match(/^(\p{Emoji}+)\s*(.+)$/u);
    label.textContent = emojiMatch ? emojiMatch[2].trim() : labelText;
  } else {
    label.textContent = model.label || model.value;
  }
  item.appendChild(label);

  return item;
}

/**
 * Update select dropdown UI with selected value
 * @param {HTMLElement} selectElement - Select element
 * @param {string} value - Selected value
 * @param {string} labelText - Display label
 */
export function updateSelectDisplay(selectElement, value, labelText) {
  const selected = selectElement.querySelector('.select-selected');
  if (!selected) return;

  const provider = value.split('/')[0];
  const iconSrc = getProviderIcon(provider);
  const iconSpan = selected.querySelector('.select-icon');
  
  iconSpan.innerHTML = '';
  if (iconSrc) {
    const img = document.createElement('img');
    img.src = iconSrc;
    img.alt = provider;
    img.width = 16;
    img.height = 16;
    iconSpan.appendChild(img);
  }
  
  const labelElement = selected.querySelector('.select-label');
  if (labelElement) {
    labelElement.textContent = labelText;
  }
}

/**
 * Sanitize YouTube video title
 * @param {string} title - Raw title
 * @returns {string} Sanitized title
 */
export function sanitizeTitle(title) {
  if (typeof title !== 'string') {
    return '';
  }

  return title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*-\s*YouTube$/i, '')
    .trim();
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
export function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format inline markdown (bold, italic, code)
 * @param {string} text - Text with markdown
 * @returns {string} HTML formatted text
 */
export function formatInlineMarkdown(text) {
  // Process markdown patterns before escaping
  // Bold (**text** or __text__)
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // Italic (*text* or _text_) - only match if not part of bold
  text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  text = text.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');
  
  // Code (`text`)
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Split by HTML tags, escape non-tag parts, then rejoin
  const parts = text.split(/(<[^>]+>)/g);
  const result = parts.map((part, index) => {
    // Odd indices are HTML tags, keep them as-is
    if (index % 2 === 1) {
      return part;
    }
    // Even indices are text content, escape it
    return escapeHTML(part);
  });
  
  return result.join('');
}

/**
 * Convert markdown to HTML
 * @param {string} markdown - Markdown text
 * @returns {string} HTML string
 */
export function convertMarkdownToHTML(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return '<div class="summary-placeholder">No summary available</div>';
  }

  const lines = markdown.split('\n');
  const result = [];
  let inList = false;
  let inParagraph = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (inParagraph) {
        result.push('</p>');
        inParagraph = false;
      }
      continue;
    }

    // Headers
    if (line.match(/^###\s+(.+)$/)) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (inParagraph) {
        result.push('</p>');
        inParagraph = false;
      }
      const headerText = line.replace(/^###\s+/, '');
      result.push(`<h3>${escapeHTML(headerText)}</h3>`);
    } else if (line.match(/^##\s+(.+)$/)) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (inParagraph) {
        result.push('</p>');
        inParagraph = false;
      }
      const headerText = line.replace(/^##\s+/, '');
      result.push(`<h2>${escapeHTML(headerText)}</h2>`);
    } else if (line.match(/^#\s+(.+)$/)) {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (inParagraph) {
        result.push('</p>');
        inParagraph = false;
      }
      const headerText = line.replace(/^#\s+/, '');
      result.push(`<h2>${escapeHTML(headerText)}</h2>`);
    }
    // Bullet lists
    else if (line.match(/^[\*\-•]\s+(.+)$/)) {
      if (inParagraph) {
        result.push('</p>');
        inParagraph = false;
      }
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      const listItemText = line.replace(/^[\*\-•]\s+/, '');
      result.push(`<li>${formatInlineMarkdown(listItemText)}</li>`);
    }
    // Regular paragraph text
    else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      if (!inParagraph) {
        result.push('<p>');
        inParagraph = true;
      } else {
        result.push('<br>');
      }
      result.push(formatInlineMarkdown(line));
    }
  }

  // Close any open tags
  if (inList) {
    result.push('</ul>');
  }
  if (inParagraph) {
    result.push('</p>');
  }

  return result.join('');
}

/**
 * Display summary in the UI
 * @param {string} summaryText - Summary text (markdown)
 * @param {HTMLElement} summaryElement - Summary content element
 */
export function displaySummary(summaryText, summaryElement) {
  summaryElement.innerHTML = convertMarkdownToHTML(summaryText);
}
