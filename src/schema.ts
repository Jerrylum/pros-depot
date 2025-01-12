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

/**
 * An entry in the depot.
 */
export type BaseTemplate = z.infer<typeof BaseTemplateSchema>

export const DepotSchema = z.array(BaseTemplateSchema)

/**
 * A list of base templates, stored in a JSON file. PROS-CLI uses
 * this files as a catalog of templates.
 */
export type Depot = z.infer<typeof DepotSchema>

export const ExternalTemplateSchema = z.object({
  'py/object': z.literal(
    'pros.conductor.templates.external_template.ExternalTemplate'
  ),
  'py/state': z.object({
    metadata: z.record(z.string(), z.any()),
    name: z.string(),
    supported_kernels: z.string(),
    system_files: z.array(z.string()),
    target: z.string(),
    user_files: z.array(z.string()),
    version: z.string()
  })
})

/**
 * The content of the template.pros file in the template zip file.
 */
export type ExternalTemplate = z.infer<typeof ExternalTemplateSchema>
