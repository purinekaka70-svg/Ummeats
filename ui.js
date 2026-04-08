function getToastContainer() {
  return document.getElementById("toastContainer");
}

export function showToast(message, tone = "info") {
  const toastContainer = getToastContainer();
  if (!toastContainer) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}
