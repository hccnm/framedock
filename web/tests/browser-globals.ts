/** The app modules under test read browser storage while initialising, which Bun does not provide. */
const values = new Map<string, string>();

Object.assign(globalThis, {
    localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, String(value)),
        removeItem: (key: string) => void values.delete(key),
    },
});
