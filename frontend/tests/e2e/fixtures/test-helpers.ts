import { Page, TestInfo } from "@playwright/test";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Required env var ${name} is not set. Set it before running E2E tests.`);
    }
    return value;
}

const username = requireEnv("KIMA_TEST_USERNAME");
const password = requireEnv("KIMA_TEST_PASSWORD");
const baseUrl = process.env.KIMA_UI_BASE_URL || "http://127.0.0.1:3030";

export async function loginAsTestUser(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL(/\/($|\?|home)/);
}

export function skipIfNoEnv(envVar: string, testInfo: TestInfo): void {
    if (!process.env[envVar]) {
        testInfo.skip(true, `Skipping: ${envVar} not set`);
    }
}

export async function waitForApiHealth(page: Page, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await page.request.get(`${baseUrl}/api/health`);
            if (response.ok()) return;
        } catch {}
        await page.waitForTimeout(1000);
    }
    throw new Error("API health check timed out");
}

export { username, password, baseUrl };
