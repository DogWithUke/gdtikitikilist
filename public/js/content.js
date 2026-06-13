import { round, score } from './score.js';

/**
 * Path to directory containing `_list.json` and all levels
 */
const dir = '/data';

async function fetchAcceptedRecords() {
    try {
        const res = await fetch('/api/public/records');
        if (!res.ok) return [];
        const body = await res.json();
        return Array.isArray(body.records) ? body.records : [];
    } catch (e) {
        console.warn('Failed to load accepted records', e);
        return [];
    }
}

async function fetchCustomLevels() {
    try {
        const res = await fetch('/api/public/custom-levels');
        if (!res.ok) return [];
        const body = await res.json();
        return Array.isArray(body.levels) ? body.levels : [];
    } catch (e) {
        console.warn('Failed to load custom levels', e);
        return [];
    }
}

async function fetchHiddenLevels() {
    try {
        const res = await fetch('/api/public/hidden-levels');
        if (!res.ok) return [];
        const body = await res.json();
        return Array.isArray(body.names) ? body.names : [];
    } catch (e) {
        console.warn('Failed to load hidden levels', e);
        return [];
    }
}

export async function fetchList() {
    const [listResult, accepted, customLevels, hiddenNames] = await Promise.all([
        fetch(`${dir}/_list.json`),
        fetchAcceptedRecords(),
        fetchCustomLevels(),
        fetchHiddenLevels(),
    ]);
    try {
        const list = await listResult.json();
        const baseLevelsRaw = await Promise.all(
            list.map(async (path, rank) => {
                const levelResult = await fetch(`${dir}/${path}.json`);
                try {
                    const level = await levelResult.json();
                    return [{ ...level, path }, null];
                } catch {
                    console.error(`Failed to load level #${rank + 1} ${path}.`);
                    return [null, path];
                }
            }),
        );

        const hiddenSet = new Set(
            (hiddenNames || []).map((n) => String(n).toLowerCase()),
        );
        const baseLevels = baseLevelsRaw.filter(
            ([lvl]) => !lvl || !hiddenSet.has(String(lvl.name).toLowerCase()),
        );

        // Insert custom levels at their positions (1-indexed)
        const sortedCustom = [...customLevels].sort(
            (a, b) => a.position - b.position,
        );
        for (const cl of sortedCustom) {
            const path = `custom:${cl.id}`;
            const level = {
                id: cl.level_id,
                name: cl.name,
                author: cl.publisher || cl.verifier,
                creators: cl.creators || [],
                verifier: cl.verifier,
                publisher: cl.publisher,
                verification: cl.verification,
                percentToQualify: 100,
                password: cl.password || 'Free to Copy',
                records: [],
                path,
                customPoints: Number(cl.points) || 0,
            };
            const idx = Math.max(0, Math.min(baseLevels.length, cl.position - 1));
            baseLevels.splice(idx, 0, [level, null]);
        }

        // Merge accepted submissions per level
        return baseLevels.map(([level, err]) => {
            if (!level) return [null, err];
            const dynamic = accepted
                .filter((r) => r.level_path === level.path)
                .map((r) => ({
                    user: r.username,
                    link: r.record_link,
                    percent: 100,
                    hz: r.hz ?? 60,
                }));
            const merged = [...(level.records || []), ...dynamic];
            return [
                {
                    ...level,
                    records: merged.sort((a, b) => b.percent - a.percent),
                },
                null,
            ];
        });
    } catch {
        console.error(`Failed to load list.`);
        return null;
    }
}

export async function fetchEditors() {
    try {
        const editorsResults = await fetch(`${dir}/_editors.json`);
        const editors = await editorsResults.json();
        return editors;
    } catch {
        return null;
    }
}

export async function fetchLeaderboard() {
    const list = await fetchList();

    const scoreMap = {};
    const errs = [];
    list.forEach(([level, err], rank) => {
        if (err) {
            errs.push(err);
            return;
        }

        const levelScore = (percent) => {
            if (typeof level.customPoints === 'number' && level.customPoints > 0) {
                if (percent === 100) return level.customPoints;
                return round(level.customPoints * (2 / 3));
            }
            return score(rank + 1, percent, level.percentToQualify);
        };

        // Verification
        const verifier = Object.keys(scoreMap).find(
            (u) => u.toLowerCase() === level.verifier.toLowerCase(),
        ) || level.verifier;
        scoreMap[verifier] ??= {
            verified: [],
            completed: [],
            progressed: [],
        };
        const { verified } = scoreMap[verifier];
        verified.push({
            rank: rank + 1,
            level: level.name,
            score: levelScore(100),
            link: level.verification,
        });

        // Records
        level.records.forEach((record) => {
            const user = Object.keys(scoreMap).find(
                (u) => u.toLowerCase() === record.user.toLowerCase(),
            ) || record.user;
            scoreMap[user] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };
            const { completed, progressed } = scoreMap[user];
            if (record.percent === 100) {
                completed.push({
                    rank: rank + 1,
                    level: level.name,
                    score: levelScore(100),
                    link: record.link,
                });
                return;
            }

            progressed.push({
                rank: rank + 1,
                level: level.name,
                percent: record.percent,
                score: levelScore(record.percent),
                link: record.link,
            });
        });
    });

    // Wrap in extra Object containing the user and total score
    const res = Object.entries(scoreMap).map(([user, scores]) => {
        const { verified, completed, progressed } = scores;
        const total = [verified, completed, progressed]
            .flat()
            .reduce((prev, cur) => prev + cur.score, 0);

        return {
            user,
            total: round(total),
            ...scores,
        };
    });

    // Sort by total score
    return [res.sort((a, b) => b.total - a.total), errs];
}
