import { test, expect } from '@playwright/test';
import { workbook, bytes } from '../fixtures';
const xlsxFile = () => ({
  name: 'synthetic.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from(bytes(workbook())),
});
test('empty workspace → import → edit → approve → export → backup/reset/restore', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.getByText('Your pricing workspace starts here')).toBeVisible();
  await page.screenshot({ path: 'test-results/empty-workspace.png', fullPage: true });
  await page.getByLabel('Import workbook file').setInputFiles(xlsxFile());
  await expect(page.getByRole('dialog', { name: 'Workbook import preview' })).toBeVisible();
  await expect(page.getByText('3', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue to replace' }).click();
  await expect(page.getByRole('button', { name: 'Replace catalogue', exact: true })).toBeDisabled();
  await page.getByLabel('Type REPLACE to continue').fill('REPLACE');
  await page.getByRole('button', { name: 'Replace catalogue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'TEST-100', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/synthetic-catalogue.png', fullPage: true });
  await page.getByLabel('Search catalogue').fill('TEST-100');
  await expect(page.getByRole('button', { name: 'TEST-200', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'TEST-100', exact: true }).click();
  await page.getByRole('tab', { name: 'Selling Price', exact: true }).click();
  await page.getByLabel('Frost selling price (£ ex VAT)').fill('250');
  await page.screenshot({ path: 'test-results/synthetic-product-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit selling price for TEST-100' })).toContainText(
    '£250.00',
  );
  await page.getByRole('link', { name: 'Settings & Backup' }).click();
  await page.getByLabel('I verified these assumptions').check();
  await page.getByRole('button', { name: 'Save & confirm assumptions' }).click();
  await expect(page.getByRole('status')).toContainText('FX assumptions confirmed');
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'TEST-100', exact: true }).click();
  await page.getByRole('tab', { name: 'Selling Price', exact: true }).click();
  await page.getByLabel('I have reviewed these warnings').check();
  await page.getByRole('button', { name: 'Save & approve for sales' }).click();
  await expect(page.getByRole('status')).toContainText('Price approved');
  await page.getByRole('link', { name: 'Export Sales List' }).click();
  await expect(page.getByText('1 included', { exact: true })).toBeVisible();
  const [sales] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Excel (.xlsx)' }).click(),
  ]);
  expect(sales.suggestedFilename()).toMatch(/^Frost_Sales_Price_List_\d{4}-\d{2}-\d{2}\.xlsx$/);
  await page.getByRole('button', { name: 'Print / Save as PDF', exact: true }).click();
  const print = page.frameLocator('iframe[title="Sanitized sales print document"]');
  await expect(print.locator('tbody tr')).toHaveCount(1);
  await expect(print.locator('body')).not.toContainText('SYNTHETIC_CONFIDENTIAL_MARKER');
  const printHtml = await print.locator('html').evaluate((el) => el.outerHTML);
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(printHtml);
  await pdfPage.pdf({
    path: 'test-results/synthetic-sales-list.pdf',
    format: 'A4',
    landscape: true,
    printBackground: true,
  });
  await pdfPage.close();
  await page.screenshot({ path: 'test-results/synthetic-print-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Settings & Backup' }).click();
  const [backup] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export confidential backup (.json)' }).click(),
  ]);
  const path = await backup.path();
  if (!path) throw new Error('Backup download failed');
  await page.getByRole('button', { name: 'Reset this browser’s data' }).click();
  await page.getByLabel('Type RESET to continue').fill('RESET');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Local data reset');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Restore backup file').setInputFiles(path);
  await page.getByLabel('Type RESTORE to continue').fill('RESTORE');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('backup restored');
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit selling price for TEST-100' })).toContainText(
    '£250.00',
  );
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
});
test('CRUD, archive exclusion, delete confirmation, snapshot undo and subpath refresh', async ({
  page,
}) => {
  await page.goto('./#Catalogue');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Brand / manufacturer *').fill('Synthetic Brand');
  await page.getByLabel('Model / SKU', { exact: true }).fill('FAKE-01');
  await page.getByLabel('Product name *').fill('Synthetic manual instrument');
  await page.getByRole('tab', { name: 'Selling Price', exact: true }).click();
  await page.getByLabel('Frost selling price (£ ex VAT)').fill('150');
  await page.getByLabel('I have reviewed these warnings').check();
  await page.getByRole('button', { name: 'Save & approve for sales' }).click();
  await page.getByRole('button', { name: 'FAKE-01', exact: true }).click();
  await page.getByRole('button', { name: 'Archive product', exact: true }).click();
  await expect(page.getByText('archived', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Export Sales List' }).click();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'FAKE-01', exact: true }).click();
  await page.getByRole('button', { name: 'Permanently delete product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await page.getByLabel('Type DELETE to continue').fill('DELETE');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Your pricing workspace starts here')).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'FAKE-01', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'FAKE-01', exact: true })).toBeVisible();
});
test('mobile layout stays within viewport and no third-party requests occur', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173') && !r.url().startsWith('data:'))
      external.push(r.url());
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Product catalogue' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(external).toEqual([]);
});
