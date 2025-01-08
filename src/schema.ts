import { z } from 'zod'

export const BaseTemplateSchema = z.object({
  metadata: z.object({
    location: z.string()
  }),
  name: z.string(),
  'py/object': z.literal('pros.conductor.templates.base_template.BaseTemplate'),
  supported_kernels: z.string(),
  target: z.string(),
  version: z.string()
})
export type BaseTemplate = z.infer<typeof BaseTemplateSchema>

export const DepotSchema = z.array(BaseTemplateSchema)
export type Depot = z.infer<typeof DepotSchema>
