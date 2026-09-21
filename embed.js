(function () {
    'use strict';

    if (document.getElementById('xuanlang-chatbot-frame')) return;

    var HOST_URL = 'https://nguyenmanh1509.github.io/chatbot-UBND-Xa-xuan-Lang/?v=2026';

    function createStyles() {
        var css = [
            '#xuanlang-chatbot-frame {',
            '  position: fixed !important;',
            '  bottom: 24px !important;',
            '  right: 24px !important;',
            '  width: 420px !important;',
            '  height: 640px !important;',
            '  max-width: calc(100vw - 20px) !important;',
            '  max-height: calc(100vh - 110px) !important;',
            '  border: none !important;',
            '  border-radius: 16px !important;',
            '  box-shadow: 0 20px 50px rgba(0,0,0,0.35) !important;',
            '  z-index: 999999 !important;',
            '  background: linear-gradient(135deg, #0B3D62, #1e54c7) !important;',
            '  display: block !important;',
            '  transition: transform 0.3s ease;',
            '}',
            '#xuanlang-chatbot-frame:hover {',
            '  transform: translateY(-4px);',
            '}',
            '@media (max-width: 520px) {',
            '  #xuanlang-chatbot-frame {',
            '    width: calc(100vw - 20px) !important;',
            '    height: calc(100vh - 110px) !important;',
            '    right: 10px !important;',
            '    bottom: 90px !important;',
            '    border-radius: 14px !important;',
            '  }',
            '}'
        ].join('\n');

        var style = document.createElement('style');
        style.id = 'xuanlang-chatbot-styles';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }

    function createFrame() {
        var iframe = document.createElement('iframe');
        iframe.id = 'xuanlang-chatbot-frame';
        iframe.src = HOST_URL;
        iframe.title = 'Chatbot UBND Xã Xuân Lãng';
        iframe.setAttribute('allow', 'clipboard-write');
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('scrolling', 'no');
        return iframe;
    }

    function init() {
        createStyles();
        var iframe = createFrame();
        document.body.appendChild(iframe);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
