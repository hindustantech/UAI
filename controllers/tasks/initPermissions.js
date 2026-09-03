import Permission from '../../models/Permission.js';

// Initialize task management permissions
export const initializeTaskPermissions = async () => {
  try {
    const taskResources = [
      'task',
      'task_assignment',
      'task_invitation',
      'task_work_session',
      'task_comment',
      'task_attachment'
    ];

    const taskActions = [
      'create', 'read', 'update', 'delete', 'list',
      'manage', 'assign', 'reassign', 'invite',
      'accept', 'reject', 'start', 'stop', 'resume',
      'submit', 'verify', 'reopen', 'close',
      'activate', 'deactivate', 'cancel',
      'comment', 'attachment', 'history',
      'time_view', 'time_edit', 'report_view'
    ];

    // Generate permissions for each resource
    for (const resource of taskResources) {
      const permissions = [];
      
      for (const action of taskActions) {
        // Create permission key
        const key = `${resource}.${action}`;
        
        // Check if permission already exists
        const existing = await Permission.findOne({ key });
        
        if (!existing) {
          permissions.push({
            resource,
            action,
            key,
            name: `${resource} ${action}`,
            description: `${action} permission for ${resource}`,
            system: true,
            adminOnly: false
          });
        }
      }

      // Bulk insert if there are new permissions
      if (permissions.length > 0) {
        await Permission.insertMany(permissions, { ordered: false }).catch(() => {});
        console.log(`✅ Initialized ${permissions.length} permissions for ${resource}`);
      }
    }

    // Also create some compound permissions for common use cases
    const compoundPermissions = [
      { resource: 'task', action: 'create_self', key: 'task.create.self', name: 'Create own tasks' },
      { resource: 'task', action: 'create_any', key: 'task.create.any', name: 'Create tasks for others' },
      { resource: 'task', action: 'view_all', key: 'task.view.all', name: 'View all tasks' },
      { resource: 'task', action: 'view_assigned', key: 'task.view.assigned', name: 'View assigned tasks' },
      { resource: 'task', action: 'history_view', key: 'task.history.view', name: 'View task history' },
      { resource: 'task', action: 'time_view', key: 'task.time.view', name: 'View task time' },
      { resource: 'task', action: 'time_edit', key: 'task.time.edit', name: 'Edit task time' },
      { resource: 'task', action: 'report_view', key: 'task.report.view', name: 'View task reports' }
    ];

    for (const perm of compoundPermissions) {
      const existing = await Permission.findOne({ key: perm.key });
      if (!existing) {
        await Permission.create({ ...perm, system: true });
      }
    }

    console.log('✅ Task permissions initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing task permissions:', error);
  }
};