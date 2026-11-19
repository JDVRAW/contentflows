// Profile and Deliveries pages: picking a logo or photo uploads it right away.
document.querySelectorAll('.logo-form input[type=file], .photo-form input[type=file]').forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.files.length) return;
    input.form.classList.add('busy');
    input.form.submit();
  });
});

// Changing the email asks for the current password; the field only shows once the email differs.
const email = document.querySelector('.profile-details input[name=email]');
const pass = document.querySelector('.profile-details .email-pass');
if (email && pass) {
  const sync = () => {
    const changed = email.value.trim().toLowerCase() !== email.dataset.was;
    pass.hidden = !changed;
    pass.querySelector('input').required = changed;
  };
  email.addEventListener('input', sync);
  sync();
}
