import {DefaultCrudRepository} from '@loopback/repository';
import {Trees, TreesRelations} from '../models';
import {TreetrackerDataSource} from '../datasources';
import {inject} from '@loopback/core';
import expect from 'expect-runtime';

export class TreesRepository extends DefaultCrudRepository<
  Trees,
  typeof Trees.prototype.id,
  TreesRelations
> {
  constructor(
    @inject('datasources.treetracker') dataSource: TreetrackerDataSource,
  ) {
    super(Trees, dataSource);
  }

  async getEntityIdsByOrganizationId(
    organizationId: number,
  ): Promise<Array<number>> {
    expect(organizationId).number();
    expect(this).property('execute').defined();
    const result = await this.execute(
      `select * from getEntityRelationshipChildren(${organizationId})`,
      [],
    );
    return result.map((e) => e.entity_id);
  }

  async getPlanterIdsByOrganizationId(
    organizationId: number,
  ): Promise<Array<number>> {
    expect(organizationId).number();
    const result = await this.execute(
      `select * from planter where organization_id in (select entity_id from getEntityRelationshipChildren(${organizationId}))`,
      [],
    );
    expect(result).match([{id: expect.any(Number)}]);
    return result.map((e) => e.id);
  }
}
