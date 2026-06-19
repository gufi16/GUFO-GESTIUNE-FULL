UPDATE "Uom"
SET "standardCode" = CASE LOWER(TRIM("code"))
  WHEN 'buc' THEN 'H87'
  WHEN 'set' THEN 'SET'
  WHEN 'portie' THEN 'C62'
  WHEN 'kg' THEN 'KGM'
  WHEN 'g' THEN 'GRM'
  WHEN 'l' THEN 'LTR'
  WHEN 'ml' THEN 'MLT'
  WHEN 'bax' THEN 'C62'
  WHEN 'cutie' THEN 'XBX'
  WHEN 'sac' THEN 'XBG'
  WHEN 'lada' THEN 'XCR'
  WHEN 'pachet' THEN 'XPA'
  WHEN 'bidon' THEN 'XCI'
  WHEN 'sticla' THEN 'XBO'
  WHEN 'doza' THEN 'XCX'
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
