/** Download rows as CSV, with a BOM so Excel shows Tamil/Hindi text correctly. */
export function downloadCsv(name: string, header: string[], rows: (string | null | undefined)[][]) {
  const cell = (v: string | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}
