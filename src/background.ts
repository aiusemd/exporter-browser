// Service worker entry. MV3 evicts after ~30s of idle, so we treat it as
// stateless and recover any in-flight job state from chrome.storage when
// we wake up.

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[aiuse] installed:', details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  console.info('[aiuse] started');
});
