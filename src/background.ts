chrome.runtime.onInstalled.addListener((details) => {
  console.info('[aiuse] installed:', details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  console.info('[aiuse] started');
});
