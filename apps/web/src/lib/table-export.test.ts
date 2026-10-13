import ExcelJS from 'exceljs'
import { tableCsv, tableFileName, tableXlsx, type ExportTable } from './table-export'

const TABLE: ExportTable = {
  sheet: 'Clinical trials: all [x]',
  columns: [{ header: 'Date', kind: 'date' }, { header: 'Title' }, { header: 'Year', kind: 'date' }, { header: 'Source link', kind: 'link' }],
  rows: [
    ['2021-03-01', 'TETON, "phase 3" for Sàrl', '2021', 'https://clinicaltrials.gov/study/NCT1'],
    ['2020-07', '=HYPERLINK("x")', '', ''],
  ],
  about: [
    ['Asset', 'Treprostinil (United Therapeutics)'],
    ['Records', 2],
  ],
}

describe('table export', () => {
  it('names files <stem>-<local day>.<ext>', () => {
    expect(tableFileName('treprostinil-company-ir', new Date(2026, 9, 13, 23, 30), 'csv')).toBe('treprostinil-company-ir-2026-10-13.csv')
    expect(tableFileName('a b/c', new Date(2026, 0, 2), 'xlsx')).toBe('a-b-c-2026-01-02.xlsx')
  })

  it('writes CSV with a BOM, CRLF rows, quoting and the formula guard', () => {
    const csv = tableCsv(TABLE)
    expect(csv.startsWith('﻿Date,Title,Year,Source link\r\n')).toBe(true)
    expect(csv).toContain('2021-03-01,"TETON, ""phase 3"" for Sàrl",2021,https://clinicaltrials.gov/study/NCT1\r\n')
    expect(csv).toContain(`2020-07,"'=HYPERLINK(""x"")",,\r\n`)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('writes a workbook with a bold frozen header, an autofilter, date cells, links and an About sheet', async () => {
    const at = new Date(2026, 9, 13, 9, 5)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await (await tableXlsx(TABLE, at)).arrayBuffer())
    const [ws] = wb.worksheets
    expect(ws!.name).toBe('Clinical trials  all  x ')
    expect(ws!.getRow(1).values).toEqual([undefined, 'Date', 'Title', 'Year', 'Source link'])
    expect(ws!.getRow(1).font?.bold).toBe(true)
    expect(ws!.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws!.autoFilter).toBeTruthy()
    expect(ws!.rowCount).toBe(3)
    expect(ws!.getCell('A2').value).toEqual(new Date(Date.UTC(2021, 2, 1)))
    expect(ws!.getCell('A2').numFmt).toBe('yyyy-mm-dd')
    expect(ws!.getCell('A3').numFmt).toBe('yyyy-mm')
    expect(ws!.getCell('C2').numFmt).toBe('yyyy')
    // Excel stores text, not formulas: the cell holds the literal text.
    expect(ws!.getCell('B3').value).toBe('=HYPERLINK("x")')
    expect(ws!.getCell('D2').value).toMatchObject({ hyperlink: 'https://clinicaltrials.gov/study/NCT1' })
    expect(ws!.getCell('D3').value).toBeFalsy()
    const about = wb.getWorksheet('About')!
    const facts = Object.fromEntries(about.getSheetValues().filter(Boolean).map((r) => [(r as unknown[])[1], (r as unknown[])[2]]))
    expect(facts).toMatchObject({ Asset: 'Treprostinil (United Therapeutics)', Records: 2 })
    expect(facts.Exported).toBeInstanceOf(Date)
  })
})
