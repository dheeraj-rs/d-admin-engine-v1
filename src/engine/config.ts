import 'dotenv/config';
import path from 'path';

const getAllowedOrigins = (): string[] | boolean => {
  const origins = process.env.ALLOWED_ORIGINS || '';
  const list = origins.split(',').map((origin) => origin.trim()).filter(Boolean);
  return list.length > 0 ? list : true;
};

export const config = {
  projectsDir: path.join(process.cwd(), 'projects'),
  port: process.env.PORT || 3001,
  host: process.env.HOST || '0.0.0.0',
  allowedOrigins: getAllowedOrigins(),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
};
