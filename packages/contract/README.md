# @planora/widget-contract

Shared zod schemas and TypeScript types for the Planora widget API (`/api/v1/widget`). The widget uses the types, and any server that implements the API can validate requests with the schemas.

```ts
import { CreateTicketRequest, type TicketDetail } from '@planora/widget-contract';
import { ENDPOINTS, DEFAULT_STATUS_LABELS } from '@planora/widget-contract/constants'; // no zod, safe for browser bundles
```

The API follows Laravel conventions: responses are wrapped in `{ "data": … }`, errors are `{ "message", "errors"? }` with 422 for validation, and IDs are integers.

Full spec: https://github.com/GonzagaLloyd/PlanoraFE/blob/main/docs/WIDGET_API.md
