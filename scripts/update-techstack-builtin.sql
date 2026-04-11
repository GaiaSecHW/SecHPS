-- Update all TechStackOption records to set isBuiltin = false
UPDATE TechStackOption SET isBuiltin = 0 WHERE isBuiltin = 1;
