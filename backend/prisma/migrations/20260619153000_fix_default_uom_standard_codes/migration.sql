UPDATE "Uom"
SET "standardCode" = CASE LOWER(TRIM("code"))
  WHEN 'buc' THEN 'C62'
  WHEN 'set' THEN 'SET'
  WHEN 'portie' THEN 'C62'
  WHEN 'kg' THEN 'KGM'
  WHEN 'g' THEN 'GRM'
  WHEN 'l' THEN 'LTR'
  WHEN 'ml' THEN 'MLT'
  WHEN 'bax' THEN 'XBX'
  WHEN 'cutie' THEN 'BX'
  WHEN 'sac' THEN 'BG'
  WHEN 'lada' THEN 'CS'
  WHEN 'pachet' THEN 'PK'
  WHEN 'bidon' THEN 'BO'
  WHEN 'sticla' THEN 'BO'
  WHEN 'doza' THEN 'BX'
  ELSE "standardCode"
END
WHERE LOWER(TRIM("code")) IN (
  'buc',
  'set',
  'portie',
  'kg',
  'g',
  'l',
  'ml',
  'bax',
  'cutie',
  'sac',
  'lada',
  'pachet',
  'bidon',
  'sticla',
  'doza'
);
