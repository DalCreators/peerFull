/**
 * CodeSync landing page script
 * Handles the Stripe checkout modal flow.
 */
(function () {
  'use strict';

  // Point this at your deployed Railway server
  const SERVER_URL = 'https://codesync-server.railway.app';

  const checkoutBtn   = document.getElementById('checkout-btn');
  const modal         = document.getElementById('checkout-modal');
  const modalOverlay  = document.getElementById('modal-overlay');
  const modalClose    = document.getElementById('modal-close');
  const emailInput    = document.getElementById('checkout-email');
  const modalCheckout = document.getElementById('modal-checkout-btn');

  // Open modal
  checkoutBtn?.addEventListener('click', () => {
    modal.classList.remove('hidden');
    modalOverlay.classList.remove('hidden');
    emailInput.focus();
  });

  // Close modal
  function closeModal() {
    modal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  }
  modalClose?.addEventListener('click', closeModal);
  modalOverlay?.addEventListener('click', closeModal);

  // Checkout
  modalCheckout?.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.style.borderColor = '#dc2626';
      emailInput.focus();
      return;
    }
    emailInput.style.borderColor = '';

    modalCheckout.textContent = 'Redirecting…';
    modalCheckout.disabled = true;

    try {
      const res = await fetch(`${SERVER_URL}/api/stripe/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error(err);
      modalCheckout.textContent = 'Error — try again';
      modalCheckout.disabled = false;
    }
  });

  // Handle Enter key in email input
  emailInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modalCheckout.click();
  });
})();
