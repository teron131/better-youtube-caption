/**
 * Tooltip Management
 * Handles info icon tooltips with delay functionality
 */

/**
 * Initialize tooltips for all info icons
 */
export function initializeTooltips() {
  const infoIcons = document.querySelectorAll('.info-icon');
  const iconTooltips = new Map(); // Track icon -> tooltip element
  
  infoIcons.forEach(icon => {
    // Wrap icon if not already wrapped
    let wrapper = icon.parentElement;
    if (!wrapper || !wrapper.classList.contains('info-icon-wrapper')) {
      wrapper = document.createElement('span');
      wrapper.className = 'info-icon-wrapper';
      icon.parentNode.insertBefore(wrapper, icon);
      wrapper.appendChild(icon);
    }
    
    // Create tooltip element and append to wrapper
    const tooltip = document.createElement('div');
    tooltip.className = 'info-tooltip';
    tooltip.textContent = icon.getAttribute('data-tooltip');
    wrapper.appendChild(tooltip);
    
    // Store reference
    iconTooltips.set(icon, { tooltip: tooltip, hideTimeout: null });

    // Setup event listeners
    setupTooltipListeners(icon, iconTooltips.get(icon));
  });
}

/**
 * Setup event listeners for a tooltip
 * @param {HTMLElement} icon - Info icon element
 * @param {Object} state - Tooltip state object
 */
function setupTooltipListeners(icon, state) {
  const { tooltip, hideTimeout } = state;

  icon.addEventListener('mouseenter', function() {
    // Clear any pending hide timeout
    if (state.hideTimeout) {
      clearTimeout(state.hideTimeout);
      state.hideTimeout = null;
    }
    
    // Show tooltip
    tooltip.classList.remove('hide');
    tooltip.classList.add('show');
  });

  icon.addEventListener('mouseleave', function(e) {
    // Start delay - will be cancelled if mouse enters tooltip
    state.hideTimeout = setTimeout(() => {
      tooltip.classList.remove('show');
      tooltip.classList.add('hide');
      state.hideTimeout = null;
    }, 2000);
  });

  // Keep tooltip visible when hovering over it
  tooltip.addEventListener('mouseenter', function() {
    if (state.hideTimeout) {
      clearTimeout(state.hideTimeout);
      state.hideTimeout = null;
    }
    tooltip.classList.remove('hide');
    tooltip.classList.add('show');
  });

  tooltip.addEventListener('mouseleave', function() {
    // Delay before hiding
    state.hideTimeout = setTimeout(() => {
      tooltip.classList.remove('show');
      tooltip.classList.add('hide');
      state.hideTimeout = null;
    }, 500);
  });
}
