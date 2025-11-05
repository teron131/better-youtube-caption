/**
 * Custom Select Dropdown Management
 * Handles initialization and interaction for custom select elements
 */

/**
 * Initialize custom select dropdowns
 */
function initializeCustomSelects() {
  const customSelects = document.querySelectorAll('.custom-select');
  
  customSelects.forEach(select => {
    const type = select.dataset.modelType;
    const itemsContainer = select.querySelector('.select-items');
    const hiddenInput = select.querySelector('input[type="hidden"]');
    
    if (!itemsContainer || !hiddenInput) return;
    
    const modelList = type === 'summarizer' 
      ? RECOMMENDED_SUMMARIZER_MODELS 
      : RECOMMENDED_REFINER_MODELS;
    const defaultModel = type === 'summarizer' 
      ? DEFAULTS.MODEL_SUMMARIZER 
      : DEFAULTS.MODEL_REFINER;

    // Populate options
    itemsContainer.innerHTML = '';
    
    if (Array.isArray(modelList) && modelList.length > 0) {
      modelList.forEach(model => {
        const option = createOptionElement(model, type);
        itemsContainer.appendChild(option);
      });
    }

    // Add default if not in list
    if (defaultModel && !modelList.some(m => m.value === defaultModel)) {
      const defaultModelObj = { value: defaultModel, label: defaultModel };
      const defaultOption = createOptionElement(defaultModelObj, type);
      itemsContainer.appendChild(defaultOption);
    }

    // Setup event listeners
    setupSelectListeners(select, hiddenInput);
  });

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select')) {
      document.querySelectorAll('.custom-select.open').forEach(s => {
        s.classList.remove('open');
      });
      document.querySelectorAll('.select-items.show').forEach(i => {
        i.classList.remove('show');
      });
    }
  });
}

/**
 * Setup event listeners for a select element
 * @param {HTMLElement} select - Select element
 * @param {HTMLElement} hiddenInput - Hidden input element
 */
function setupSelectListeners(select, hiddenInput) {
  const selected = select.querySelector('.select-selected');
  const items = select.querySelector('.select-items');
  
  if (!selected || !items) return;

  selected.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = select.classList.contains('open');
    
    // Close all other selects
    document.querySelectorAll('.custom-select.open').forEach(s => {
      s.classList.remove('open');
    });
    document.querySelectorAll('.select-items.show').forEach(i => {
      i.classList.remove('show');
    });
    
    // Toggle this select
    if (!isOpen) {
      select.classList.add('open');
      items.classList.add('show');
    }
  });

  items.addEventListener('click', (e) => {
    const item = e.target.closest('.select-item');
    if (!item) return;

    const value = item.dataset.value;
    const labelText = item.querySelector('.item-label').textContent;
    const provider = value.split('/')[0];
    const iconSrc = getProviderIcon(provider);

    // Update selected display
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
    
    select.classList.remove('open');
    items.classList.remove('show');

    // Update items selection state
    items.querySelectorAll('.select-item').forEach(i => {
      i.classList.remove('selected');
    });
    item.classList.add('selected');

    // Update hidden input and save
    hiddenInput.value = value;
    saveSetting(hiddenInput.id, value);
  });
}

/**
 * Set selected value for a custom select
 * @param {string} modelType - Model type ('summarizer' or 'refiner')
 * @param {string} value - Model value to select
 */
function setSelectValue(modelType, value) {
  const select = document.querySelector(`[data-model-type="${modelType}"]`);
  if (!select) return;

  const hiddenInput = select.querySelector('input[type="hidden"]');
  const items = select.querySelector('.select-items');
  const selected = select.querySelector('.select-selected');
  
  if (!hiddenInput || !items || !selected) return;

  // Update hidden input
  hiddenInput.value = value;

  // Find matching item
  const matchingItem = items.querySelector(`[data-value="${value}"]`);
  
  // Update display
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
  
  let labelText = value.split('/')[1] || value;
  if (matchingItem) {
    labelText = matchingItem.querySelector('.item-label').textContent;
    matchingItem.classList.add('selected');
    items.querySelectorAll('.select-item').forEach(i => {
      if (i !== matchingItem) i.classList.remove('selected');
    });
  }
  
  const labelElement = selected.querySelector('.select-label');
  if (labelElement) {
    labelElement.textContent = labelText;
  }
}

