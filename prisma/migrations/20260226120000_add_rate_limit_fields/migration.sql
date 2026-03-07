-- Add per-key rate limit override to ApiKey
ALTER TABLE "ApiKey" ADD COLUMN "rateLimitRpm" INTEGER;

-- Add customer-level Pixel Factory RPM setting to CustomerSettings
ALTER TABLE "CustomerSettings" ADD COLUMN "pixelFactoryRpm" INTEGER;
