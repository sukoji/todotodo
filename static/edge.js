document.querySelector('#restore').addEventListener('click', () => window.todoEdge.restore());
window.todoEdge.side().then(side => {document.querySelector('#restore span').textContent = side === 'left' ? '›' : '‹';});
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
