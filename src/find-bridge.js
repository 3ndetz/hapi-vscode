'use strict';
// Chromium's native text finder preserves the website DOM and scrolls the
// selected match into view, including text spanning inline markup.
function findBridge() {
    if (parent === window) return;
    let query = '', restoreFocus;
    window.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
            event.preventDefault(); event.stopPropagation();
            restoreFocus = document.activeElement;
            parent.postMessage({ type: 'hapi-find-open' }, '*');
        }
    }, true);
    window.addEventListener('message', event => {
        if (event.source !== parent) return;
        if (event.data?.type === 'hapi-find-close') {
            window.getSelection()?.removeAllRanges(); query = '';
            restoreFocus?.focus({ preventScroll: true }); return;
        }
        if (event.data?.type !== 'hapi-find-text' || typeof event.data.query !== 'string') return;
        const text = event.data.query;
        if (text !== query || event.data.reset) {
            restoreFocus ||= document.activeElement;
            const selection = window.getSelection(); selection?.removeAllRanges();
            const range = document.createRange(); range.selectNodeContents(document.body); range.collapse(true); selection?.addRange(range);
        }
        query = text;
        if (!text) window.getSelection()?.removeAllRanges();
        const supported = typeof window.find === 'function';
        const found = !!text && supported && window.find(text, false, event.data.backwards === true, true, false, false, false);
        parent.postMessage({ type: 'hapi-find-result', query: text, found, supported }, '*');
    });
}
module.exports = { findBridge };
