// Applies the saved/system colour theme before first paint (external file so the CSP can stay strict).
try {
  var t = localStorage.getItem('bl-theme');
  if (t === 'dark' || ((!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
