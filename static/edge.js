document.querySelector('#restore').addEventListener('click', () => window.todoEdge.restore());
window.todoEdge.side().then(side => {document.querySelector('#restore span').textContent = side === 'left' ? '›' : '‹';});
