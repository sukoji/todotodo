document.querySelector('#restore').addEventListener('click', () => window.todoEdge.restore());
document.querySelector('#restore').addEventListener('keydown', event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  window.todoEdge.move(window.screenY + (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 40 : 12));
  window.todoEdge.drop();
});
const showSide = side => {document.querySelector('#restore span').textContent = side === 'left' ? '›' : '‹';};
window.todoEdge.side().then(showSide);
window.todoEdge.onSideChanged(showSide);
const grip = document.querySelector('.edge-grip');
let drag = null;
grip.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = {pointerId:event.pointerId, startY:event.screenY, windowY:window.screenY, moved:false};
  grip.setPointerCapture(event.pointerId);
  event.preventDefault();
});
grip.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const delta = event.screenY - drag.startY;
  if (Math.abs(delta) < 3 && !drag.moved) return;
  drag.moved = true;
  window.todoEdge.move(drag.windowY + delta);
});
function finishDrag() {
  if (!drag) return;
  if (drag.moved) window.todoEdge.drop();
  drag = null;
}
grip.addEventListener('pointerup', finishDrag);
grip.addEventListener('pointercancel', finishDrag);
grip.addEventListener('lostpointercapture', finishDrag);
