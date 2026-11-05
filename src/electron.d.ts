export {};

declare global {
  interface VaultMarkdownFile {
    path: string;
    content: string;
    modifiedAt: string;
  }

  interface CustomerBoardBridge {
    chooseCustomerRoot(): Promise<string | null>;
    getCustomerRoot(): Promise<string | null>;
    listMarkdown(): Promise<VaultMarkdownFile[]>;
    writeMarkdown(relativePath: string, content: string): Promise<void>;
    trashMarkdown(relativePath: string): Promise<void>;
    onVaultChanged(callback: () => void): () => void;
  }

  interface Window {
    customerBoard?: CustomerBoardBridge;
  }
}
