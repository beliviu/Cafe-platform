import { useOutletContext } from 'react-router-dom'
import { AvailabilityPanel } from '../components/staff/AvailabilityPanel.jsx'
import { Card, PageHeader } from '../components/ui/index.js'

export function StaffMenuPage() {
  const { cafe, features } = useOutletContext()
  return (
    <div className="page page-narrow">
      <PageHeader
        eyebrow={cafe.name}
        title="Menu habis"
        description="Matikan menu yang sedang habis. Customer tetap melihatnya, tapi abu-abu dan tidak bisa dipesan."
      />
      <Card>
        <AvailabilityPanel cafe={cafe} features={features} />
      </Card>
    </div>
  )
}
