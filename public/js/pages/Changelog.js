import Spinner from '../components/Spinner.js';

export default {
    components: { Spinner },
    template: `
        <main v-if="loading" class="page-changelog">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-changelog">
            <div class="changelog-wrap">
                <h1>List Changelog</h1>
                <p class="type-label-md" style="color:#aaa; margin-bottom: 1.5rem;">
                    All level changes — additions, deletions, restores. When a level is added at a position, every level from that spot onward is pushed down by one.
                </p>
                <p v-if="events.length === 0" class="type-label-md" style="color:#aaa">No events yet.</p>
                <ul v-else class="changelog-list">
                    <li v-for="ev in events" :key="ev.id" :class="'cl-' + ev.event_type">
                        <div class="cl-row">
                            <span class="cl-badge">{{ ev.event_type }}</span>
                            <span class="cl-name">{{ ev.level_name }}</span>
                            <span v-if="ev.position" class="cl-pos">#{{ ev.position }}</span>
                            <span v-if="ev.details && ev.details.source" class="cl-src">[{{ ev.details.source }}]</span>
                        </div>
                        <div v-if="ev.event_type === 'added' && ev.position" class="cl-meta">
                            Levels previously at #{{ ev.position }} and below were each dethroned one spot down.
                        </div>
                        <time class="cl-time">{{ formatDate(ev.occurred_at) }}</time>
                    </li>
                </ul>
            </div>
        </main>
    `,
    data: () => ({
        loading: true,
        events: [],
    }),
    async mounted() {
        try {
            const res = await fetch('/api/public/changelog');
            const body = await res.json();
            this.events = Array.isArray(body.events) ? body.events : [];
        } catch (e) {
            console.warn('Failed to load changelog', e);
        } finally {
            this.loading = false;
        }
    },
    methods: {
        formatDate(iso) {
            try { return new Date(iso).toLocaleString(); } catch { return iso; }
        },
    },
};
