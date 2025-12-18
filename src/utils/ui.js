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
 * SAFE: Escapes HTML first, then applies markdown formatting
 * @param {string} text - Text with markdown
 * @returns {string} HTML formatted text
 */
export function formatInlineMarkdown(text) {
  if (!text) return '';
  
  // 1. Escape HTML first to prevent XSS
  let result = escapeHTML(text);
  
  // 2. Apply markdown replacements
  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // Italic (*text* or _text_) - only match if not part of bold
  result = result.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  result = result.replace(/(?<!_)_([^_]+?)_(?!_)/g, '<em>$1</em>');
  
  // Code (`text`)
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  return result;
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
 * Render structured analysis object to HTML
 * @param {Object} analysis - Analysis object
 * @returns {string} HTML string
 */
function renderStructuredAnalysis(analysis) {
  if (!analysis) return '<div class="summary-placeholder">No summary available</div>';

  const { summary, takeaways, key_facts } = analysis;
  let html = '<div class="structured-analysis">';

  // Header
  html += `
    <div class="analysis-header-container">
      <div class="analysis-badge">AI ANALYSIS</div>
      <h2 class="analysis-title">Structured Analysis</h2>
    </div>
  `;

  // Summary Section
  if (summary) {
    html += `
      <div class="analysis-section">
        <div class="section-header">
          <div class="section-icon summary-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
          </div>
          <h3 class="section-title">SUMMARY</h3>
        </div>
        <div class="section-content">
          <p>${formatInlineMarkdown(summary)}</p>
        </div>
      </div>
    `;
  }

  // Key Takeaways Section
  if (takeaways && takeaways.length > 0) {
    html += `
      <div class="analysis-section">
        <div class="section-header">
          <div class="section-icon takeaways-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a4.5 4.5 0 0 0-4.5 4.5v9a4.5 4.5 0 0 0 4.5 4.5H17"></path></svg>
          </div>
          <h3 class="section-title">KEY TAKEAWAYS</h3>
        </div>
        <ul class="takeaways-list">
          ${takeaways.map(item => `
            <li>
              <div class="check-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <span>${formatInlineMarkdown(item)}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  // Video Chapters (Key Facts) Section
  // Handle both legacy key_facts (string[]) and new chapters (object[])
  const chapters = analysis.chapters || key_facts;
  
  if (chapters && chapters.length > 0) {
    html += `
      <div class="analysis-section">
        <div class="section-header">
          <div class="section-icon chapters-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          </div>
          <h3 class="section-title">VIDEO CHAPTERS</h3>
        </div>
        <ul class="chapters-list">
          ${chapters.map((item, index) => {
            let content = '';
            
            // Handle structured chapter object (header, summary, key_points)
            if (typeof item === 'object') {
              const header = item.header ? `<div class="chapter-heading">${formatInlineMarkdown(item.header)}</div>` : '';
              const summary = item.summary ? `<div class="chapter-summary">${formatInlineMarkdown(item.summary)}</div>` : '';
              const keyPoints = item.key_points && Array.isArray(item.key_points) 
                ? `<ul class="chapter-keypoints">
                    ${item.key_points.map(kp => `<li class="chapter-keypoint">${formatInlineMarkdown(kp)}</li>`).join('')}
                   </ul>` 
                : '';
              content = header + summary + keyPoints;
            } 
            // Handle simple string key fact
            else {
              content = formatInlineMarkdown(item);
              if (content.includes(':')) {
                  const parts = content.split(':');
                  content = `<strong class="chapter-label">${parts[0]}:</strong>${parts.slice(1).join(':')}`;
              }
            }
            
            return `
            <li>
              <div class="chapter-number">${index + 1}</div>
              <div class="chapter-content">
                ${content}
              </div>
            </li>
          `}).join('')}
        </ul>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

/**
 * Display summary in the UI
 * @param {string|Object} summaryData - Summary text (markdown) or structured analysis object
 * @param {HTMLElement} summaryElement - Summary content element
 */
export function displaySummary(summaryData, summaryElement) {
  if (typeof summaryData === 'object' && summaryData !== null && !Array.isArray(summaryData)) {
    summaryElement.innerHTML = renderStructuredAnalysis(summaryData);
  } else {
    summaryElement.innerHTML = convertMarkdownToHTML(summaryData);
  }
}
