import { postgresRequest } from './neon-data.mjs';
import { AppError } from './errors.mjs';

export function config(env = process.env) {
  const awsEndpoint = env.AWS_ENDPOINT_URL_S3 || env.NEON_S3_ENDPOINT || env.NEON_OBJECT_STORAGE_ENDPOINT;
  const accessKeyId = env.AWS_ACCESS_KEY_ID || env.NEON_OBJECT_STORAGE_ACCESS_KEY || env.NEON_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || env.NEON_OBJECT_STORAGE_SECRET_KEY || env.NEON_S3_SECRET_ACCESS_KEY;
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-2';
  const bucket = env.FAMILY_STORAGE_BUCKET || env.FAMILY_MATERIALS_BUCKET || 'family-materials';
  const url = env.SUPABASE_URL || env.NEON_DATA_API_URL || awsEndpoint || env.NEON_AUTH_BASE_URL || '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEON_SERVICE_ROLE_KEY || accessKeyId || secretAccessKey || '';
  return { url, key, bucket, region, accessKeyId, secretAccessKey, awsEndpoint };
}

// Injectable only for isolated unit tests. Production always uses server-side PostgreSQL.
export const dataAdapter = { request: postgresRequest };
export const request = (path, options={}) => dataAdapter.request(path, options);
export const rows = (table, query='', options={}) => request(`/rest/v1/${table}?${query}`, options);
export const rpc = (name, body, options={}) => request(`/rest/v1/rpc/${name}`, { ...options, method:'POST', body });
export const eq = value => encodeURIComponent(String(value));
export async function allRows(table, query='', options={}) {
  const result=[];
  for(let offset=0;offset<20000;offset+=500) {
    const page=await rows(table,`${query}${query?'&':''}limit=500&offset=${offset}`,options);
    result.push(...page); if(page.length<500)return result;
  }
  throw new AppError(503,'This collection needs a paginated view before more records can be loaded.');
}
