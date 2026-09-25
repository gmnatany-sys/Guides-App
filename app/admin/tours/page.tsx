import {requirePermission} from '@/lib/authorization'
import TourManager from './tour-manager'
export default async function ToursPage(){await requirePermission('tours_manage_access');return <TourManager/>}
