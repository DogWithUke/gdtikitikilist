import routes from './routes.js';

export const store = Vue.reactive({
    dark: JSON.parse(localStorage.getItem('dark')) || false,
    toggleDark() {
        this.dark = !this.dark;
        localStorage.setItem('dark', JSON.stringify(this.dark));
    },
});

const app = Vue.createApp({
    data: () => ({ store }),
});
const router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes,
});

app.use(router);

app.mount('#app');

// Clean-mode toggle: small floating button in the bottom-right corner.
(function setupCleanMode() {
    const KEY = 'clean-mode';
    const btn = document.createElement('button');
    btn.className = 'clean-toggle';
    btn.setAttribute('aria-label', 'Toggle clean mode');
    const apply = (on) => {
        document.body.classList.toggle('clean-mode', !!on);
        btn.textContent = on ? '✦' : '✧';
        btn.title = on
            ? 'Clean mode on — click to turn off'
            : 'Clean mode off — click for a cleaner look';
    };
    btn.addEventListener('click', () => {
        const next = !document.body.classList.contains('clean-mode');
        localStorage.setItem(KEY, JSON.stringify(next));
        apply(next);
    });
    document.body.appendChild(btn);
    const saved = JSON.parse(localStorage.getItem(KEY) || 'false');
    apply(saved);
})();
