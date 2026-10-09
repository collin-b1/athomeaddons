const input = document.getElementById('omdbApiKey');
const status = document.getElementById('status');

chrome.storage.sync.get('omdbApiKey').then(({ omdbApiKey }) => {
  if (omdbApiKey) input.value = omdbApiKey;
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ omdbApiKey: input.value.trim() });
  status.textContent = 'Saved.';
  setTimeout(() => (status.textContent = ''), 2000);
});
