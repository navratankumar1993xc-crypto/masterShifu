/* WEB_TS Panel — Client JS */

// Sidebar toggle for mobile
const toggleBtn = document.getElementById('sidebarToggle');
const sidebar   = document.getElementById('sidebar');
if (toggleBtn && sidebar) {
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!sidebar.contains(e.target) && e.target !== toggleBtn) {
      sidebar.classList.remove('open');
    }
  });
}

// Auto-dismiss alerts after 6 seconds
setTimeout(() => {
  document.querySelectorAll('.alert.fade.show').forEach(el => {
    const bsAlert = bootstrap.Alert.getOrCreateInstance(el);
    bsAlert.close();
  });
}, 6000);

// Uppercase key input
document.querySelectorAll('input[name="key_value"]').forEach(input => {
  input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
});
