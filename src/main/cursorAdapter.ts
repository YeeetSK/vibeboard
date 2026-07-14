export interface CursorAdapterStatus {
  available: boolean
  label: string
}

export interface CursorAdapter {
  status(): Promise<CursorAdapterStatus>
}

export class PlaceholderCursorAdapter implements CursorAdapter {
  async status(): Promise<CursorAdapterStatus> {
    return {
      available: false,
      label: 'Cursor adapter ready'
    }
  }
}
