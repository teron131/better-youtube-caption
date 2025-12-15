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
    // Odd indices are HTML tags, keep as-is; even indices are text, escape them
    return index % 2 === 1 ? part : escapeHTML(part);
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
