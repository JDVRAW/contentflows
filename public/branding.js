// Branding: picking a logo file uploads it right away.
document.querySelectorAll('.logo-form input[type=file]').forEach((input) => {
  input.addEventListener('change', () => { if (input.files.length) input.form.submit(); });
});
