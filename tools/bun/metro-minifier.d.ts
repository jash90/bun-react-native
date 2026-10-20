interface MinifyOptions {
  code: string;
  map?: object;
  filename: string;
  reserved: string[];
  config: object;
}

interface MinifiedMap {
  sources: string[];
  [key: string]: unknown;
}

export default function minify(options: MinifyOptions & { map: object }): Promise<{ code: string; map: MinifiedMap }>;
export default function minify(options: MinifyOptions): Promise<{ code: string; map?: MinifiedMap }>;
