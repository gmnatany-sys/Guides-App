import {requirePermission} from '@/lib/authorization'
import GuideManager from './guide-manager'
export default async function GuidesPage(){await requirePermission('users_manage_access');return <GuideManager/>}
