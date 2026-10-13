import { indicationName, shortIndication } from './utils'

describe('shortIndication', () => {
  it('takes a bracketed abbreviation, trailing or leading', () => {
    expect(shortIndication('Pulmonary arterial hypertension (PAH)')).toBe('PAH')
    expect(shortIndication('Hypertension (HTN)')).toBe('HTN')
    expect(shortIndication('IBD (Inflammatory Bowel Disease)')).toBe('IBD')
  })

  it('abbreviates known full names, whatever the case, apostrophes and hyphens', () => {
    const cases: [string, string][] = [
      ['Pulmonary Arterial Hypertension', 'PAH'],
      ['idiopathic pulmonary fibrosis', 'IPF'],
      ['Progressive Pulmonary Fibrosis', 'PPF'],
      ['Interstitial Lung Disease', 'ILD'],
      ['Pulmonary hypertension associated with interstitial lung disease', 'PH-ILD'],
      ['Chronic Thromboembolic Pulmonary Hypertension', 'CTEPH'],
      ['Chronic Kidney Disease', 'CKD'],
      ['Multiple Sclerosis', 'MS'],
      ['Relapsing Multiple Sclerosis', 'RMS'],
      ['Relapsing Remitting Multiple Sclerosis', 'RRMS'],
      ["Crohn's Disease", 'CD'],
      ['Crohn’s disease', 'CD'],
      ['Crohn Disease', 'CD'],
      ['Crohn&#39;s Disease', 'CD'],
      ['Crohns Disease', 'CD'],
      ['Ulcerative Colitis', 'UC'],
      ['Rheumatoid arthritis', 'RA'],
      ['Systemic Sclerosis', 'SSc'],
      ['Heart Failure', 'HF'],
      ['Heart Failure With Preserved Ejection Fraction', 'HFpEF'],
      ['Primary Aldosteronism', 'PA'],
      ['Type 2 Diabetes Mellitus', 'T2D'],
      ['Type2 Diabetes', 'T2D'],
      ['Psoriasis', 'PsO'],
      ['Psoriatic-arthritis', 'PsA'],
      ['Ankylosing Spondylitis', 'AS'],
    ]
    for (const [name, short] of cases) expect(shortIndication(name), name).toBe(short)
  })

  it('reads inverted MeSH names the natural way round', () => {
    expect(shortIndication('Colitis, Ulcerative')).toBe('UC')
    expect(shortIndication('Arthritis, Rheumatoid')).toBe('RA')
    expect(shortIndication('Diabetes Mellitus, Type 2')).toBe('T2D')
    expect(shortIndication('Lung Diseases, Interstitial')).toBe('ILD')
    expect(shortIndication('Multiple Sclerosis, Relapsing-Remitting')).toBe('RRMS')
    expect(shortIndication('Hypertension, Pulmonary')).toBe('PH')
  })

  it('keeps unknown names and abbreviations as they are', () => {
    expect(shortIndication('Hypertension')).toBe('Hypertension')
    expect(shortIndication('Healthy Volunteers')).toBe('Healthy Volunteers')
    expect(shortIndication('PAH')).toBe('PAH')
    expect(shortIndication('PH-ILD')).toBe('PH-ILD')
  })

  it('names a known abbreviation', () => {
    expect(indicationName('PAH')).toBe('Pulmonary arterial hypertension')
    expect(indicationName('ph-ild')).toBe('Pulmonary hypertension associated with interstitial lung disease')
    expect(indicationName('HTN')).toBe('Hypertension')
    expect(indicationName('XYZ')).toBeUndefined()
  })
})
