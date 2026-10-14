import { ChevronDown } from 'lucide-react'
import type { ShapeChoiceOption, ShapeRecommendationSection, ShapeRecommendationSectionId } from './shapeRecommendation.ts'
import { shapeOptionIdMatchesSection } from './shapeRecommendation.ts'
import { DocMarkdown } from '../components/DocMarkdown.tsx'

const MAX_SHAPE_OPTIONS = 4

function optionsForSection(options: ShapeChoiceOption[]): ShapeChoiceOption[] {
  const custom = options.filter((opt) => opt.custom)
  const concrete = options.filter((opt) => !opt.custom).slice(0, MAX_SHAPE_OPTIONS)
  return [...concrete, ...(custom.length ? [custom[0]] : [])]
}

function benefitLines(benefits: string[] | undefined): string[] {
  return (benefits || []).filter((line) => !/^Matched to your requirement/i.test(line.trim()))
}

type Props = {
  sections: ShapeRecommendationSection[]
  activeBySection: Record<string, string | undefined>
  onSelect: (sectionId: string, option: ShapeChoiceOption) => void
  disabled?: boolean
}

export function ShapeRecommendationSections({ sections, activeBySection, onSelect, disabled }: Props) {
  return (
    <>
      {sections
        .filter((section) => section.applicable && section.options.length > 0)
        .map((section) => (
          <section key={section.id} className="card shape-section">
            <div className="shape-section-head">
              <h3 className="card-title">{section.title}</h3>
              <span className="shape-section-meta">Pick one — expand for developer detail</span>
            </div>
            <div className="tech-option-grid" role="list" aria-label={section.title}>
              {optionsForSection(section.options).map((option) => {
                const sectionId = section.id as ShapeRecommendationSectionId
                const selectedId = activeBySection[section.id]
                const active = shapeOptionIdMatchesSection(sectionId, selectedId, option.id)
                const aiTopPick = Boolean(option.recommended && !option.custom)
                const showAiPickStyle = aiTopPick && !active && !selectedId
                return (
                  <div
                    key={`${section.id}-${option.id}`}
                    role="listitem"
                    className={`tech-option-card shape-option-card${showAiPickStyle ? ' is-recommended' : ''}${
                      option.custom ? ' is-custom' : ''
                    }${active ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="shape-option-card__select"
                      disabled={disabled}
                      aria-pressed={active}
                      onClick={() => onSelect(section.id, option)}
                    >
                      <div className="tech-option-card__head">
                        <strong>{option.label}</strong>
                        {active ? (
                          <span className="tech-option-tag tech-option-tag--selected">Selected</span>
                        ) : aiTopPick && !selectedId ? (
                          <span className="tech-option-tag">AI top pick</span>
                        ) : null}
                      </div>
                      {option.hint ? <p className="shape-option-hint">{option.hint}</p> : null}
                      {benefitLines(option.benefits).length ? (
                        <ul className="tech-option-benefits">
                          {benefitLines(option.benefits)
                            .slice(0, 4)
                            .map((benefit) => (
                              <li key={benefit}>{benefit}</li>
                            ))}
                        </ul>
                      ) : null}
                    </button>
                    <details className="shape-option-details">
                      <summary>
                        <ChevronDown size={14} aria-hidden="true" />
                        Details for developers
                      </summary>
                      <div className="shape-option-details__body">
                        {option.developerDetails?.trim() ? (
                          <DocMarkdown text={option.developerDetails} />
                        ) : (
                          <p className="muted">No extra detail from the recommender.</p>
                        )}
                      </div>
                    </details>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
    </>
  )
}
