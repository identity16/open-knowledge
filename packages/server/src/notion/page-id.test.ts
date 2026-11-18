import { describe, expect, test } from 'vitest';
import { parseNotionPageId } from './page-id.ts';

const ID = '41ca0a3f-aba4-8150-aad5-c7e056948abe';

describe('parseNotionPageId', () => {
  test.each([
    ['https://www.notion.so/My-Page-41ca0a3faba48150aad5c7e056948abe', ID],
    ['https://www.notion.so/joon/My-Page-41ca0a3faba48150aad5c7e056948abe?pvs=4', ID],
    ['https://app.notion.com/p/41ca0a3faba48150aad5c7e056948abe?pvs=204', ID],
    ['https://joon.notion.site/41ca0a3faba48150aad5c7e056948abe', ID],
    ['41ca0a3faba48150aad5c7e056948abe', ID],
    [ID, ID],
    [ID.toUpperCase(), ID],
  ])('%s', (input, expected) => {
    expect(parseNotionPageId(input)).toBe(expected);
  });

  test.each([
    [''],
    ['not a page'],
    ['https://example.com/41ca0a3faba48150aad5c7e056948abe'],
    ['https://www.notion.so/My-Page'],
  ])('rejects %s', (input) => {
    expect(parseNotionPageId(input)).toBeNull();
  });
});
