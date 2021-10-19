export interface VxFile {
  name: string;
  path: string;
}

export interface VxFiles {
  inputFiles: VxFile[];
  outputFiles: VxFile[];
}

export default class ConverterClient {
  constructor(private readonly target: string) {}

  async setInputFile(name: string, content: File): Promise<void> {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('file', content);

    const response = await fetch(`/convert/${this.target}/submitfile`, {
      method: 'POST',
      body: formData,
    });
    const result = await response.json();

    if (result.status !== 'ok') {
      throw new Error(
        `failed to upload file named "${name}": ${JSON.stringify(result)}`
      );
    }
  }

  async process(): Promise<void> {
    const response = await fetch(`/convert/${this.target}/process`, {
      method: 'POST',
    });
    const result = await response.json();

    if (result.status !== 'ok') {
      throw new Error(`failed to process files: ${JSON.stringify(result)}`);
    }
  }

  async getOutputFile(name: string): Promise<Blob> {
    const response = await fetch(
      `/convert/${this.target}/output?name=${encodeURIComponent(name)}`,
      { cache: 'no-store' }
    );
    return await response.blob();
  }

  async getFiles(): Promise<VxFiles> {
    const response = await fetch(`/convert/${this.target}/files`, {
      cache: 'no-store',
    });
    return await response.json();
  }

  async reset(): Promise<void> {
    await fetch('/convert/reset', { method: 'POST' });
  }
}
